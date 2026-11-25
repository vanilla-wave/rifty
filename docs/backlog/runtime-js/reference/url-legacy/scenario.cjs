// biome-ignore lint/style/useNodejsImportProtocol: model-written code, as an agent writes it.
const url = require('url');
const parseurl = require('parseurl');
console.log(url.resolve('https://example.com/guide/a', '../img/b.png'));
const u = url.parse('http://u:p@a.com:8/b?c=d#e', true);
console.log(u.auth, u.host, u.hostname, u.port, u.path, JSON.stringify(u.query));
console.log(url.format(url.parse('HTTP://Ex.com/a b')));
console.log(url.parse('http://ñ.com/').hostname);
const p = parseurl({ url: 'http://a.com:8/x?y=1' });
console.log(p.host, p.pathname, p.query);
