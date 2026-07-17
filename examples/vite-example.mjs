//#region src/add.js
function e(e, t) {
	return e + t;
}
//#endregion
//#region src/main.js
function t() {
	return e(2, 3);
}
console.log("result:", t());
//#endregion
export { t as run };
