//On the fly JSX to JS compiler used for dynamic components

const swc = require("@swc/core");
const fs = require("fs");

module.exports = {
  initialize: async function () {
    console.log("\n\x1b[32m%s\x1b[0m", "JSX Compiler Initialization Completed");
  },
  compileJSX: async function (filePath) {
    const newPath = filePath.replace(".jsx", ".js");

    log_info("compileJSX", filePath, newPath);

    try {
      const jsx = fs.readFileSync(filePath, "utf8");

      const jsOut = await compileJSX(jsx);
      const noImports = stripImports(jsOut);
      const safeCode = patchDefaultProps(noImports);

      try {
        fs.writeFileSync(newPath, safeCode, "utf8");
      } catch (e) {
        // log_error("Error saving JSX->JS File", e)
      }

      return safeCode;
    } catch (e) {
      log_error(e);
      return "JIT Compilation Failed for Component";
    }
  },
};

function patchDefaultProps(code) {
  return code.replace(
    /function\s+(\w+)\s*\(\s*\{([\s\S]*?)\}\s*\)(?!\s*=\s*\{\})/,
    "function $1({$2} = {})"
  );
}

function stripImports(code) {
  return code.replace(/^import\s+.*?;$/gm, "");
}
async function compileJSX(jsxString) {
  const { code } = await swc.transform(jsxString, {
    jsc: {
      target: "es2020",
      parser: { syntax: "ecmascript", jsx: true },
      transform: {
        react: {
          runtime: "classic",
        },
      },
    },
    module: { type: "es6" },
  });

  return code;
}
