const text = "MUYUNGAKLKTIMOTHY<<K<KLKLKLKLLKLKLLKLKLKL";
const newText = text.replace(/([A-Z]{3,})(LKK|KKL|LKL|KKK|LLL|KLK|LKC|KLC)([A-Z]{3,})/g, "$1<<$3");
console.log("Replaced:", newText);
