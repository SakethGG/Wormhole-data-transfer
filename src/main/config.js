'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  corner: 'bottom-right',
  pos: null, // { x, y } once the user drags the widget; overrides corner
  autoAccept: true,
  downloadDir: null, // resolved by main to <Downloads>/Wormhole
  peer: null, // { fp, name, ip }
  openAtLogin: false,
};

class JsonStore {
  constructor(file, defaults) {
    this.file = file;
    this.data = { ...defaults };
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch { /* first run */ }
  }
  get(k) { return this.data[k]; }
  set(k, v) { this.data[k] = v; this.save(); }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }
}

module.exports = { JsonStore, DEFAULTS };
