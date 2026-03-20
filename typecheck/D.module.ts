import { defineModule, ContextOf, ContextWriterOf } from "../src";
import { A } from "./A.module";
import { B } from "./B.module";

export const CModule = defineModule()({
  name: "C",
  modules: [B, A] as const,
  boot(ctx) {
    return {
      valueC: "module:C",
    };
  },
  async shutdown(ctx) {
    const a = ctx.value;
    const b = a + 3;
    console.log(`shutdown ${ctx.value}`);
  },
});

type CContext2 = ContextOf<typeof CModule>;

const check: CContext2 = {
  value: "1",
  valueB: "2",
  valueC: "c",
  // @ts-expect-error
  noExist: 1,
};
