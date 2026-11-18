import {spawn} from 'node:child_process';
import readline from 'node:readline';
export class Client {
  constructor(script, args = [], options = {}) {
    this.n = 0;
    this.inflight = new Map();
    this.invalid = [];
    this.stderr = '';
    this.child = spawn(process.execPath, [script, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    });
    this.child.stderr.on('data', (c) => (this.stderr = (this.stderr + c).slice(-8192)));
    this.closed = new Promise((r) =>
      this.child.on('close', (code, signal) => {
        this.inflight.forEach(({reject}) => reject(Error('closed ' + code + ' ' + signal)));
        r({code, signal});
      }),
    );
    readline.createInterface({input: this.child.stdout}).on('line', (line) => {
      try {
        const m = JSON.parse(line);
        if (m.jsonrpc !== '2.0') throw Error('not JSON-RPC');
        if (m.id !== undefined) {
          const p = this.inflight.get(m.id);
          if (!p) throw Error('stray id');
          p.resolve(m);
        }
      } catch (e) {
        this.invalid.push([e.message, line.slice(0, 120)]);
      }
    });
  }
  send(method, params = {}) {
    this.child.stdin.write(JSON.stringify({jsonrpc: '2.0', method, params}) + '\n');
  }
  async rpc(method, params = {}) {
    const id = ++this.n;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        this.inflight.set(id, {resolve, reject});
        timer = setTimeout(() => reject(Error('deadline: ' + method)), 10000);
        this.child.stdin.write(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');
      });
    } finally {
      clearTimeout(timer);
      this.inflight.delete(id);
    }
  }
  async init() {
    let m = await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: {name: 'independent-smoke', version: '1'},
    });
    this.send('notifications/initialized');
    return m;
  }
  call(name, args = {}) {
    return this.rpc('tools/call', {name, arguments: args});
  }
  async close() {
    this.child.stdin.end();
    let t = setTimeout(() => this.child.kill('SIGKILL'), 2000);
    try {
      return await this.closed;
    } finally {
      clearTimeout(t);
    }
  }
}
