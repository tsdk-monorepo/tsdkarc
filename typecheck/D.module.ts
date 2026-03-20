import { defineModule, ContextOf } from "../src";
import { A } from "./A.module";
import { B } from "./B.module";

export const CModule = defineModule()({
  name: "C",
  modules: [B, A] as const,
  boot() {
    return {
      valueC: "module:C",
      value2: "module:C",
      a: 0,
    };
  },
  async shutdown(ctx) {
    console.log(`shutdown ${ctx.value}`);
  },
});

type CContext2 = ContextOf<typeof CModule>;

const check: CContext2 = {
  value2: "c",
  valueC: "c",
  a: 0,
  value: "1",
  valueB: "2",
  // @ts-expect-error
  noExist: 1,
};
