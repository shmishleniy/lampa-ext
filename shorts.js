// Shorts for Lampa: search + grid of videos; plays the best HLS variant with the TV's native player.
(function () {
  'use strict'

  var _$_75a5=["\x68\x74\x74\x70\x73\x3A\x2F\x2F\x61\x70\x69\x2E\x64\x61\x69\x6C\x79\x6D\x6F\x74\x69\x6F\x6E\x2E\x63\x6F\x6D","\x68\x74\x74\x70\x73\x3A\x2F\x2F\x77\x77\x77\x2E\x64\x61\x69\x6C\x79\x6D\x6F\x74\x69\x6F\x6E\x2E\x63\x6F\x6D"];
  var API=_$_75a5[0x0];
  var WWW=_$_75a5[0x1]
  var LIMIT = 30
  var FIELDS = 'id,title,duration,thumbnail_480_url,owner.screenname,allow_embed,width,height'

  function searchUrl(query, page) {
    return API + '/videos?fields=' + FIELDS + '&limit=' + LIMIT + '&page=' + page +
      '&search=' + encodeURIComponent(query)
  }

  function fmtDuration(s) {
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60
    return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (sec < 10 ? '0' : '') + sec
  }

  // Lampa matches HLS levels by landscape sizes and falls back to the lowest one on vertical video,
  // so pick the highest-bandwidth variant ourselves.
  function bestVariant(master, text) {
    var best = null, bw = -1, lines = text.split('\n')
    for (var i = 0; i < lines.length; i++) {
      var m = /BANDWIDTH=(\d+)/.exec(lines[i])
      if (m && lines[i + 1] && +m[1] > bw) { bw = +m[1]; best = lines[i + 1].trim().split('#')[0] }
    }
    return best ? new URL(best, master).href : master
  }

  if (typeof module !== 'undefined') module.exports = { searchUrl: searchUrl, fmtDuration: fmtDuration, bestVariant: bestVariant }
  if (typeof window === 'undefined' || !window.Lampa || window.shorts_ready) return
  window.shorts_ready = true

  // Plain XHR rather than Lampa.Reguest: forks differ in how Reguest passes headers/dataType.
  function get(url, headers, ok, fail) {
    var x = new XMLHttpRequest()
    x.open('GET', url)
    for (var k in headers) x.setRequestHeader(k, headers[k])
    x.timeout = 15000
    x.onload = function () {
      if (x.status == 200) ok(x.responseText)
      else fail('HTTP ' + x.status + ' ' + (x.getResponseHeader('X-Error-Code') || ''))
    }
    x.onerror = x.ontimeout = function () { fail('network error') }
    x.send()
    return x
  }

  function getJSON(url, ok, fail) {
    return get(url, {}, function (text) {
      var data
      try { data = JSON.parse(text) } catch (e) { return fail('bad response') }
      ok(data)
    }, fail)
  }

  function resolveStream(id, ok, fail) {
    getJSON(WWW + '/player/metadata/video/' + id + '?app=com.' + API.split('.')[1] + '.neon', function (meta) {
      if (meta.error) return fail(meta.error.title || meta.error.message || 'unavailable')
      var auto = meta.qualities && meta.qualities.auto && meta.qualities.auto[0]
      if (!auto) return fail('no stream')
      // cdndirector answers 403 (X-Error-Code E005) without X-Request-Origin; variants/segments don't need it
      get(auto.url, { 'X-Request-Origin': WWW }, function (text) {
        ok(bestVariant(auto.url, text), meta.title)
      }, fail)
    }, fail)
  }

  function Component() {
    var self = this
    var scroll = new Lampa.Scroll({ mask: true, over: true })
    var html = $('<div class="shorts"></div>')
    var search = $('<div class="shorts__search selector"></div>')
    var grid = $('<div class="shorts__grid"></div>')
    var query = Lampa.Storage.get('shorts_query', 'short drama')
    var page = 1, more = true, pending = null, busy = false, inited = false, last = null

    scroll.minus() // gives the scroll a fixed height (screen minus header); without it nothing scrolls
    scroll.append($('<div class="shorts__head"></div>').append(search))
    scroll.append(grid)
    html.append(scroll.render())

    function fail(msg) {
      console.log('Shorts', msg)
      Lampa.Noty.show('Shorts: ' + msg)
    }

    function card(v) {
      var el = $('<div class="shorts__card selector"><div class="shorts__img"><img><span class="shorts__res"></span><span class="shorts__dur"></span></div>' +
        '<div class="shorts__title"></div><div class="shorts__owner"></div></div>')
      // API data is untrusted: set as text/attributes, never as HTML
      el.find('img').attr('src', v.thumbnail_480_url || '')
      el.find('.shorts__dur').text(fmtDuration(v.duration || 0))
      if (v.width && v.height) el.find('.shorts__res').text(Math.min(v.width, v.height) + 'p') // short side: vertical 720x1280 is "720p"
      el.find('.shorts__title').text(v.title || '')
      el.find('.shorts__owner').text(v['owner.screenname'] || '')
      el.on('hover:focus', function () {
        last = el[0]
        scroll.update(el, true)
        if (grid.children().length - el.index() <= 12) load()
      })
      el.on('hover:enter', function () { play(v) })
      return el
    }

    function load() {
      if (pending || !more) return
      var first = !grid.children().length
      pending = getJSON(searchUrl(query, page), function (data) {
        pending = null
        if (!inited) return
        more = !!data.has_more
        page++
        // owners can disable embedding; the metadata endpoint then answers DM005 "Content rejected" for every client
        var list = (data.list || []).filter(function (v) { return v.allow_embed !== false })
        if (!list.length && more) return load() // whole page unplayable: fetch the next one, nothing would trigger it otherwise
        var cards = $(list.map(function (v) { return card(v)[0] }))
        grid.append(cards)
        if (first && !cards.length) grid.append('<div class="shorts__empty">Nothing found</div>')
        if (first) { self.activity.loader(false); self.activity.toggle() }
        else if (Lampa.Controller.enabled().name == 'content') Lampa.Controller.collectionAppend(cards)
      }, function (msg) {
        pending = null
        if (!inited) return
        if (first) { self.activity.loader(false); self.activity.toggle() }
        fail('search failed: ' + msg)
      })
    }

    function reset() {
      if (pending) pending.abort()
      pending = null; page = 1; more = true; last = null
      grid.empty()
      scroll.reset()
      search.text('Search: ' + query)
    }

    function play(v) {
      if (busy) return
      busy = true
      self.activity.loader(true)
      resolveStream(v.id, function (url, title) {
        busy = false
        self.activity.loader(false)
        if (inited) Lampa.Player.play({ url: url, title: title })
      }, function (msg) {
        busy = false
        self.activity.loader(false)
        fail(msg)
      })
    }

    search.on('hover:focus', function () { last = search[0] })
    search.on('hover:enter', function () {
      Lampa.Input.edit({ title: 'Shorts', value: query, free: true, nosave: true }, function (value) {
        Lampa.Controller.toggle('content') // Input returns focus to settings by default
        if (!value || value == query) return
        query = value
        Lampa.Storage.set('shorts_query', query)
        reset()
        self.activity.loader(true)
        load()
      })
    })

    this.create = function () {
      inited = true
      reset()
      this.activity.loader(true)
      load()
      return this.render()
    }

    this.start = function () {
      if (Lampa.Activity.active().activity !== this.activity) return
      Lampa.Controller.add('content', {
        toggle: function () {
          Lampa.Controller.collectionSet(scroll.render())
          Lampa.Controller.collectionFocus(last || false, scroll.render())
        },
        left: function () { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu') },
        right: function () { Navigator.move('right') },
        up: function () {
          if (Navigator.canmove('up')) Navigator.move('up')
          // spatial nav finds Search only above the first column, so jump to it from any card in the top row
          else if (last !== search[0]) Lampa.Controller.collectionFocus(search, scroll.render())
          else Lampa.Controller.toggle('head')
        },
        down: function () { Navigator.move('down') },
        back: function () { Lampa.Activity.backward() }
      })
      Lampa.Controller.toggle('content')
    }

    this.pause = function () {}
    this.stop = function () {}
    this.render = function () { return html }
    this.destroy = function () {
      inited = false
      if (pending) pending.abort()
      scroll.destroy()
      html.remove()
    }
  }

  var CSS = '<style>' +
    '.shorts{padding:0 1.5em}' +
    '.shorts__head{padding:1em 0 1.5em}' +
    '.shorts__search{display:inline-block;padding:.6em 1.4em;border-radius:1em;background:rgba(255,255,255,.1);font-size:1.3em}' +
    '.shorts__search.focus{background:#fff;color:#000}' +
    '.shorts__grid{display:flex;flex-wrap:wrap}' +
    '.shorts__card{width:11em;margin:0 1.2em 1.6em 0}' +
    '.shorts__img{position:relative;padding-top:177.78%;border-radius:.8em;overflow:hidden;background:rgba(255,255,255,.06)}' +
    '.shorts__img img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover}' +
    '.shorts__dur,.shorts__res{position:absolute;right:.4em;bottom:.4em;padding:.1em .4em;border-radius:.3em;background:rgba(0,0,0,.75);font-size:.85em}' +
    '.shorts__res{right:auto;bottom:auto;left:.4em;top:.4em}' +
    '.shorts__res:empty{display:none}' +
    '.shorts__card.focus .shorts__img{box-shadow:0 0 0 .25em #fff}' +
    '.shorts__title{margin-top:.5em;height:2.5em;line-height:1.25;overflow:hidden;font-size:.95em}' +
    '.shorts__owner{margin-top:.2em;opacity:.5;font-size:.8em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.shorts__empty{opacity:.6;padding:2em 0}' +
    '</style>'

  function init() {
    $('body').append(CSS)
    Lampa.Component.add('shorts', Component)
    var btn = $('<li class="menu__item selector"><div class="menu__ico">' +
      '<svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
      '</div><div class="menu__text">Shorts</div></li>')
    btn.on('hover:enter', function () {
      Lampa.Activity.push({ url: '', title: 'Shorts', component: 'shorts', page: 1 })
    })
    $('.menu .menu__list').eq(0).append(btn)
  }

  if (window.appready) init()
  else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') init() })
})()
