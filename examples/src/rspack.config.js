const path = require('path');
module.exports = {
  mode: 'production',
  target: 'node',
  entry: path.resolve(__dirname, 'main.cjs'),
  output: {
    path: path.resolve(__dirname, '..'),
    filename: 'rspack-example.js',
    library: { type: 'commonjs', name: 'RspackExample' }
  }
};
