import { defineModule, InferContextBy } from "../src";
import { A } from "./A.module";
import { B } from "./B.module";

type COwnSlice = {
  /** C's value */
  valueC: string;
  a?: number;
};

export const CModule = defineModule<COwnSlice>()({
  name: "C",
  modules: [B, A] as const,
  // @ts-expect-error `value2` not exist in `COwnSlice`
  boot: (ctx) => {
    ctx.set("valueC", "2");

    // @ts-expect-error `value2` not exist in `COwnSlice`
    ctx.set("value2", "2");

    return {
      valueC: "module:C",
      value2: "module:C",
    };
  },
  async shutdown(ctx) {
    console.log(`shutdown ${ctx.value}`);
  },
});

type CContext2 = InferContextBy<typeof CModule>;

const check: CContext2 = {
  valueC: "c",
  a: 0,
  // @ts-expect-error
  no: 1,
};
