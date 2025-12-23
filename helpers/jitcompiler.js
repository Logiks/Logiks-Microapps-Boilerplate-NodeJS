//On the fly JSX to JS compiler used for dynamic components

const swc = require("@swc/core");

module.exports = {

  initialize: async function() {
      // console.log("\n\x1b[32m%s\x1b[0m","JSX Compiler Initialization Completed");
  },

  compileJSX: async function(filePath) {
      const newPath = filePath.replace(".jsx", ".js");

      console.log("compileJSX", filePath, newPath);

      try {
          const jsx = fs.readFileSync(filePath, "utf8");
          
          const jsOut = await compileJSX(jsx);
          
          try {
            fs.writeFileSync(newPath, jsOut, "utf8");
          } catch(e) {
            // console.log("Error saving JSX->JS File")
          }

          return jsOut;
      } catch(e) {
          console.error(e);
          return "JIT Compilation Failed for Component";
      }
  }
}

async function compileJSX(jsxString) {
  const { code } = await swc.transform(jsxString, {
    jsc: {
      parser: {
        syntax: "ecmascript",
        jsx: true
      },
      transform: {
        react: {
          runtime: "automatic"
        }
      }
    },
    module: { type: "es6" }
  });

  return code;
}