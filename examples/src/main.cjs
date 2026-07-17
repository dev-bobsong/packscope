const { add } = require('./add.cjs');
function run() { return add(2, 3); }
console.log('result:', run());
module.exports = { run };
