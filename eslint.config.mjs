import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // three.js 장면은 useFrame 안에서 메모된 객체(재질, 지오메트리)를 직접 바꾸는 것이 정석이라
    // React Compiler 전용 규칙을 3D 레이어에서만 끈다. (React Compiler는 쓰지 않는다)
    files: ["src/components/game/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".prof/**",
  ]),
]);

export default eslintConfig;
