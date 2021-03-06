/**

This is a plugin made based on:
- [1] Leaflet.utfgrid and
- [2] Leaflet.markercluster plugins;

[1] - https://github.com/danzel/Leaflet.utfgrid
[2] - https://github.com/Leaflet/Leaflet.markercluster

*/

'use strict';

L.Util.ajax = function(url, zoom, callback) {
  // the following is from JavaScript: The Definitive Guide
  // and https://developer.mozilla.org/en-US/docs/DOM/XMLHttpRequest/Using_XMLHttpRequest_in_IE6
  if (window.XMLHttpRequest === undefined) {
    window.XMLHttpRequest = function() {
      /*global ActiveXObject:true */
      try {
        return new ActiveXObject("Microsoft.XMLHTTP");
      }
      catch  (e) {
        throw new Error("XMLHttpRequest is not supported");
      }
    };
  }

  var response, request = new XMLHttpRequest();
  request.open('GET', url);
  request.onreadystatechange = function() {
    /*jshint evil: true */
    if (request.readyState === 4 && request.status === 200) {
      if (window.JSON) {
        response = JSON.parse(request.responseText);
      } else {
        response = eval("(" + request.responseText + ")");
      }

      callback(response, zoom)
    }
  };
  request.send();
};

L.TileCluster = L.Class.extend({
  includes: L.Mixin.Events,
  options: {
    subdomains: ['m1', 'm2', 'm3', 'm4'],

    minZoom: 1,
    maxZoom: 18,
    tileSize: 256,

    useJsonP: false,
    pointerCursor: true
  },

  initialize: function(url, options) {
    L.Util.setOptions(this, options);

    this._url = url;
    this._cache = {};
    this._group = L.featureGroup();
    this._markers = L.featureGroup();
    this._jsonp_prefix = 'cl_us_ter_';

    this._tiles = {};
    this._totalCount = 0;

    if (url.match('callback={cb}') && !this.options.useJsonP) {
      console.error('Must set useJsonP options if you want use a callback function!');
      return null;
    }
    
    if (!url.match('callback={cb}') && this.options.useJsonP) {
      console.error('Must add callback={cb} url param to use with JsonP mode!');
      return null;
    }

    if (!this.options.createIcon) {
      this.options.createIcon = this._defaultIconCreateFunction;
    }

    if (!this.options.calculateClusterQtd) {
      this.options.calculateClusterQtd = this._calculateClusterQtd;
    }

    if (!this.options.formatCount) {
      this.options.formatCount = this._formatCount;
    }

    if (!this.options.polygonOpts) {
      this.options.polygonOpts = null;
    }

    if (!this.options.polygonOptsFunc) {
      this.options.polygonOptsFunc = this._getPolygonOpts;
    }

    if (this.options.iconOpts) {
      var icon = L.icon(this.options.iconOpts);

      this.options.markerOpts = {
        icon: icon
      };
    }

    if (this.options.useJsonP) {
      //Find a unique id in window we can use for our callbacks
      //Required for jsonP
      var i = 0;
      while (window[this._jsonp_prefix + i]) {
        i++;
      }
      this._windowKey = this._jsonp_prefix + i;
      window[this._windowKey] = {};
    }

    var subdomains = this.options.subdomains;
    if (typeof this.options.subdomains === 'string') {
      this.options.subdomains = subdomains.split('');
    }
  },

  _calculateClusterQtd: function(zoom) {
    return 1;
  },

  _formatCount: function(count) {
    return count;
  },

  _getPolygonOpts: function(zoom, count) {
    // this == super.options
    return this.polygonOpts;
  },

  onAdd: function(map) {
    this._map = map;
    this._container = this._map._container;

    this._group.addTo(this._map);
    this._markers.addTo(this._map);

    this._update();

    var zoom = this._map.getZoom();

    if (zoom > this.options.maxZoom || zoom < this.options.minZoom) {
      return;
    }

    this._group.on('mouseover', this._drawConvexHull, this);
    this._group.on('mouseout', this._removeConvexHull, this);
    if (this.options.clickCallback && typeof this.options.clickCallback === 'function') {
      this._group.on('click', this._clickCluster, this);
    }
    map.on('moveend', this._update, this);
    map.on('zoomend', this._update, this);
  },

  _update: function() {

    var bounds = this._map.getPixelBounds(),
        zoom = this._map.getZoom(),
        tileSize = this.options.tileSize;

    if (zoom > this.options.maxZoom || zoom < this.options.minZoom) {
      return;
    }

    var nwTilePoint = new L.Point(
        Math.floor(bounds.min.x / tileSize),
        Math.floor(bounds.min.y / tileSize)),
      seTilePoint = new L.Point(
        Math.floor(bounds.max.x / tileSize),
        Math.floor(bounds.max.y / tileSize)),
        max = this._map.options.crs.scale(zoom) / tileSize;

    // Load all required ones
    for (var x = nwTilePoint.x; x <= seTilePoint.x; x++) {
      for (var y = nwTilePoint.y; y <= seTilePoint.y; y++) {

        var xw = (x + max) % max, yw = (y + max) % max;
        if (xw < 0 || yw < 0) {
          return;
        }

        var key = zoom + '_' + xw + '_' + yw;

        if (!this._tiles.hasOwnProperty(key)) {
          this._tiles[key] = key;
          if (!this._cache.hasOwnProperty(key)) {
            this._cache[key] = null;

            if (this.options.useJsonP) {
              this._loadTileP(zoom, xw, yw);
            } else {
              this._loadTile(zoom, xw, yw);
            }
          } else {
            this._drawCluster(this._cache[key], this, key, zoom);
          }
        }
      }
    }

    var tileBounds = L.bounds(
            bounds.min.divideBy(tileSize)._floor(),
            bounds.max.divideBy(tileSize)._floor());
    this._removeOtherTiles(tileBounds);
  },

  updateCount: function() {
    this._totalCount = 0;

    for (var i in this._tiles) {
      var key = this._tiles[i];
      var data = this._cache[key];

      if (data && data[0]) {
        for (var j in data) {
          var cluster = data[j];

          if (this._tiles.hasOwnProperty(key)) {
            this._totalCount += cluster.count;
          }
        }
      }
    }

    if (this.options.updateCountCallback && typeof this.options.updateCountCallback === 'function') {
      this.options.updateCountCallback.call(this, this._totalCount);
    }
  },

  _loadTileP: function(zoom, x, y) {
    var head = document.getElementsByTagName('head')[0],
        key = zoom + '_' + x + '_' + y,
        functionName = this._jsonp_prefix + key,
        wk = this._windowKey,
        self = this;

    var url = L.Util.template(this._url, L.Util.extend({
      s: L.TileLayer.prototype._getSubdomain.call(this, { x: x, y: y }),
      z: zoom,
      x: x,
      y: y,
      cb: wk + '.' + functionName,
      cq: this.options.calculateClusterQtd(zoom)
    }, this.options));

    var script = document.createElement('script');
    script.setAttribute('type', 'text/javascript');
    script.setAttribute('src', url);

    window[wk][functionName] = function(data, zoom) {
      self._cache[key] = data;
      delete window[wk][functionName];
      head.removeChild(script);

      if (!zoom) {
        zoom = self._map.getZoom();
      }

      self._drawCluster(data, self, key, zoom);
    };

    head.appendChild(script);
  },

  _loadTile: function(zoom, x, y) {
    var url = L.Util.template(this._url, L.Util.extend({
      s: L.TileLayer.prototype._getSubdomain.call(this, { x: x, y: y }),
      z: zoom,
      x: x,
      y: y,
      cq: this.options.calculateClusterQtd(zoom)
    }, this.options));

    var key = zoom + '_' + x + '_' + y;

    var self = this;
    L.Util.ajax(url, zoom,
      function(data, zoom) {
        self._cache[key] = data;
        self._drawCluster(data, self, key, zoom);
      }
    );
  },

  _removeOtherTiles: function (bounds) {
    this._removeConvexHull();

    var kArr, x, y, key;

    for (key in this._tiles) {
      kArr = key.split('_');
      x = parseInt(kArr[1], 10);
      y = parseInt(kArr[2], 10);

      // remove tile if it's out of bounds
      if (x < bounds.min.x || x > bounds.max.x || y < bounds.min.y || y > bounds.max.y) {
        delete this._tiles[key];
        this._removeTile(key);
      }
    }
    this.updateCount();
  },

  _removeTile: function(key) {
    var group = this._group;

    var prevZoom = this._map.getZoom() - 1;
    var howMany = this.options.calculateClusterQtd(prevZoom);

    for (var i = 0; i < howMany; i++) {
      for (var index in group.getLayers()) {
        var layer = group.getLayers()[index];

        if (layer && layer.key.match(key)) {
          group.removeLayer(layer);
        }
      }

      var markers = this._markers;

      for (var index in markers.getLayers()) {
        var marker = markers.getLayers()[index];

        if (marker) {
          var markerKey = marker.key;

          if (key === markerKey) {
            markers.removeLayer(marker);
          }
        }
      }
    }
  },

  onRemove: function() {
    var map = this._map;

    this._group.off('mouseover', this._drawConvexHull, this);
    this._group.off('mouseout', this._removeConvexHull, this);
    if (this.options.clickCallback && typeof this.options.clickCallback === 'function') {
      this._group.off('click', this._clickCluster, this);
    }
    map.off('moveend', this._update, this);
    map.off('zoomend', this._update, this);

    this.clearClusters();

    if (this.options.pointerCursor) {
      this._container.style.cursor = '';
    }

    this._map.removeLayer(this._group);
    this._map.removeLayer(this._markers);
  },

  _removeConvexHull: function() {
    var ch = this._convexHull;

    if (ch && this._map.hasLayer(ch)) {
      try {
        this._map.removeLayer(ch);
      } catch (e) {
      }
    }

    this._convexHull = null;
  },

  clearClusters: function() {
    this._removeConvexHull();
    this._group.clearLayers();
  },

  _drawCluster: function(data, self, key, zoom) {
    self.updateCount();
    // Check if the zoom of cluster is the same of map
    if (data && data[0] && zoom == this._map.getZoom()) {
      for (var i in data) {
        var cluster = data[i];
        var coords = cluster.coords;
        var latlng = L.latLng(coords[0], coords[1]);

        if (cluster.count >= 2) {
          var clusterIcon = this.options.createIcon(cluster);

          var options = {
            icon: clusterIcon
          };

          if (this.options.clusterTooltip && cluster.count > 2) {
            options.title = this.options.clusterTooltip;
          }

          var clusterMarker = L.marker(latlng, options);

          clusterMarker.key = key;
          clusterMarker.id = i;
          this._group.addLayer(clusterMarker);
        } else if (cluster.count == 1) {
          var marker = L.marker(latlng, this.options.markerOpts);
          marker.key = key;
          this._markers.addLayer(marker);
        }
      }
    }
  },

  _clickCluster: function(event) {
    var key = event.layer.key;
    var id = event.layer.id;

    var data = this._cache[key];

    if (!data || !data[id]) {
      return;
    }

    data = data[id];

    data.polygon = this._wktToPolygon(data.stats.hull);

    this.options.clickCallback(event, data);
  },

  _drawConvexHull: function(event) {
    // If already had a convex hull drawed
    if (this._convexHull) {
      return;
    }

    var key = event.layer.key;
    var id = event.layer.id;
    var zoom = event.layer.zoom;

    var data = this._cache[key];

    if (!data || !data[id]) {
      return;
    }

    data = data[id];

    if (data && data.stats.hull) {
      if (data.count >= 2) {
        var wkt = data.stats.hull;
        var zoom = this._map.getZoom();

        var polygonOpts = this.options.polygonOptsFunc(zoom, data.count);

        this._convexHull = this._wktToPolygon(wkt, polygonOpts);
        if (this._convexHull) {
          try {
            this._map.addLayer(this._convexHull);
          } catch (e) {
          }
        }
      }
    }
  },

  _wktToPolygon: function(wkt, opts) {

    // Check if is a point
    if (wkt.match('POINT (.*)')) {
      return [];
    }

    // Convert a wkt POLYGON/LINESTRING to a Array of LatLng objects
    var string = wkt.replace('POLYGON', '');
    string = string.replace('LINESTRING', '');
    string = string.replace('(', '');
    string = string.replace('(', '');
    string = string.replace(')', '');
    string = string.replace(')', '');
    string = string.trim();

    var points = string.split(',');
    var lls = [];

    for (var i = 0; i < points.length; i++) {
      var point = points[i].trim();
      point = point.split(' ');

      var lat = parseFloat(point[0].trim());
      var lon = parseFloat(point[1].trim());

      lls.push(L.latLng(lat, lon));
    }

    return L.polygon(lls, opts);
  },

  _defaultIconCreateFunction: function(cluster) {
    var childCount = cluster.count;

    var smallRange = 1000;
    var mediumRange = 100000;
    var largeRange = 1000000;
    var xlRange = 5000000;

    var c = ' marker-cluster-';
    if (childCount >= xlRange) {
      c += 'extra-large';
    } else if (childCount >= largeRange) {
      c += 'large';
    } else if (childCount >= mediumRange) {
      c += 'medium';
    } else {
      c += 'small';
    }

    var iconPoint = new L.Point(50, 50);
    var klass = 'small';

    if (childCount >= xlRange) {
      iconPoint = new L.Point(70, 70);
      klass = 'extra-large';
    } else if (childCount >= largeRange) {
      iconPoint = new L.Point(65, 65);
      klass = 'large';
    } else if (childCount >= mediumRange) {
      iconPoint = new L.Point(55, 55);
      klass = 'medium';
    }

    var formattedChildCount = childCount;

    if (this.formatCount && typeof this.formatCount === 'function') {
      formattedChildCount = this.formatCount(formattedChildCount);
    } else {
      formattedChildCount = this._formatCount(childCount);
    }

    return new L.DivIcon({ html: '<div class="' + klass + '"><span>' + formattedChildCount + '</span></div>', className: 'marker-cluster' + c, iconSize: iconPoint });
  }
});

L.tileCluster = function(url, options) {
  return new L.TileCluster(url, options);
};
