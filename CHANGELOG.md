# TsdkArc Changelog

## v1.2.3

- Fix `ctx`'s `set` should only keep in `boot` hook

## v1.2.2

- Fix `ctx`'s type are any on hooks
- Chore: Delete useless code

## v1.2.1

- Fix `SetaOf` not exists

## v1.2.0

- Feat: New unified type helpers: `ContextOf<Module>` / `ContextWritterOf<Module>` / `SetOf<Module>`
- Feat: More smart `boot` return Ctx type infers! 🍻
- Breaking Change: `InferContextBy<Module>` -> `ContextOf<Module>`
- Breaking Change: `ContextWriterBy<Module>` -> `ContextWritterOf<Module>`

## v1.1.5

- Feat: add helper type `ContextWriterBy` to get `set` of `typeof module`

## v1.1.4

- Feat: improve the helper type `InferContextBy` directly infer type from **nested** modules

## v1.1.3

- Feat: add helper type `InferContextBy` directly infer type from the module

## v1.1.2

- Fix `mod.beforeShutdown` and `mod.afterShutdown` running logic

## v1.1.1

- Fix type issue with conflict context types
- Add more tests

## v1.1.0

`boot` support return `ctx` object 🚀 Thank you [@prehensilemullet's comment](https://www.reddit.com/r/node/comments/1rwnoz7/comment/ob2d9p4/?utm_source=share&utm_medium=web3x&utm_name=web3xcss&utm_term=1&utm_content=share_button)

## v1.0.1

Improve docs and Minor improvement

## v1.0.0

publish first version 🥂
