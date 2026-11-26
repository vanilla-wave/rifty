// Shared by every generator: one JSON line per file, text per page.
exports.emit = (file, pages) => console.log(JSON.stringify({ file, pages }));
