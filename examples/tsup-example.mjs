// src/add.js
function add(a, b) {
  return a + b;
}

// src/main.js
function run() {
  return add(2, 3);
}
console.log("result:", run());
export {
  run
};
