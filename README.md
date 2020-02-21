# io-ts-transformer
TypeScript transformer which converts TypeScript types to io-ts entities

# Requirement
[TypeScript](https://github.com/microsoft/typescript) >= 3.5.2

[io-ts](https://github.com/gcanti/io-ts) >= 2.x+

[fp-ts](https://github.com/gcanti/fp-ts) >= 2.0.0

# Installation

To install this package run the following command:

`npm i io-ts-transformer io-ts fp-ts`

# About this project

Io-ts is an awesome library that makes possible runtime type validation in TypeScript.
It has many advantages, but there is one fundamental flaw: it makes us duplicate information in our projects, which leads to many other problems. Let's look at this simple structure:

```TypeScript
type User = {
    name: string
    age: number
}
```

As information about this type will be lost when compiling from TypeScript to JavaScript, we need to describe an io-ts entity that would be able to validate our data at runtime.

```TypeScript
import * as t from 'io-ts'

const user = t.type({
  name: t.string,
  age: t.number
})
```

This approach has significant disadvantages:
---

1) Duplicating the same information in different forms takes time for the developer.

2) If you need to change TypeScript data type, you must not forget to change the io-ts model too. Otherwise, you can get an elusive bug or vulnerability in the system security.

The solution is automatic compile-time transformation of TypeScript types into io-ts models. Io-ts-transformer does this for you.

Package structure
---

This package exports 2 functions.
One is `buildDecoder` which is used in TypeScript code to convert TypeScript types into io-ts entities, while the other is a TypeScript custom transformer which is used to compile the `buildDecoder` function correctly.


Io-ts-transformer already can:
---

1) Transform almost all TypeScript types into io-ts models: 
- null, undefined, void, unknown
- string, boolean and number literals
- string, boolean and number types
- arrays, tuples, records, objects and functions
- type unions and intersections

2) Compute expressions passed into it.

For example, this expression

```TypeScript
buildDecoder<Omit<{ foo: 'bar', bar: number } & { data: string }, 'bar'>>()
```

will be converted into 

```TypeScript
import * as t from 'io-ts'

t.type({ foo: t.literal('bar'), data: t.string })
```

Io-ts-transformer can't do (yet?)
---

1) Transform recursive types. If you will try to do this now, you will get "Stack overflow" error. I hope, recursive types transformation feature will be implemented later. 

2) Transform classes and interfaces.

3) Work with dynamic type parameters, i.e. `buildDecoder<T>()` in the following code will be converted into `t.void` as default io-ts entity:
```typescript
import { buildDecoder } from 'io-ts-transformer'

function convertEntity<T>(entity: T) {
  return buildDecoder<T>()
}
```

4) Emulate `t.Int` and `t.exact` io-ts entities on type level.

5) Find and throw a compile-time error in cases when buildDecoder is used not as call expression. Now writing something like `buildDecoder.toString()` results in a runtime error. This is not good.

# How to use `buildDecoder`

```ts
import { buildDecoder } from 'io-ts-transformer'

type User = {
  name: string
  age: number
}

// const usersDecoder = t.array(t.type({ name: t.string, age: t.number }))
const usersDecoder = buildDecoder<Array<User>>()
```

# How to use the custom transformer

Unfortunately, TypeScript itself does not currently provide any easy way to use custom transformers (See https://github.com/Microsoft/TypeScript/issues/14419).
The followings are the example usage of the custom transformer.

webpack (with ts-loader or awesome-typescript-loader)
---

```js
// webpack.config.js
const ioTsTransformer = require('io-ts-transformer/transformer').default

module.exports = {
  // ...
  module: {
    rules: [
      {
        test: /\.ts$/,
        loader: 'ts-loader', // or 'awesome-typescript-loader'
        options: {
          // make sure not to set `transpileOnly: true` here, otherwise it will not work
          getCustomTransformers: program => ({
              before: [
                  ioTsTransformer(program)
              ]
          })
        }
      }
    ]
  }
}
```

Rollup (with rollup-plugin-typescript2)
---

```js
// rollup.config.js
import resolve from 'rollup-plugin-node-resolve'
import typescript from 'rollup-plugin-typescript2'
import ioTsTransformer from 'io-ts-transformer/transformer'

export default {
  // ...
  plugins: [
    resolve(),
    typescript({ transformers: [service => ({
      before: [ ioTsTransformer(service.getProgram()) ],
      after: []
    })] })
  ]
}
```

ttypescript
---

See [ttypescript's README](https://github.com/cevek/ttypescript/blob/master/README.md) for how to use this with module bundlers such as webpack or Rollup.

```js
// tsconfig.json
{
  "compilerOptions": {
    // ...
    "plugins": [
      { "transform": "io-ts-transformer/transformer" }
    ]
  },
  // ...
}
```
# Author's note

This package is implemented as a diploma project, and it probably would be nice to insert a couple of reviews into diploma report from people, who had time to try this package in their own projects. If you want, you can write me at awerlogus@yandex.ru or in [Telegram](t.me/awerlogus). Don't forget to report bugs you have found. I wish you a pleasant use. With love awerlogus.

Thanks to: 
- [Kimamula](https://github.com/kimamula/) for his [project](https://github.com/kimamula/ts-transformer-keys), where I took some code and readme file parts.
- My friend Vladimir for checking the grammar of my writings.

# License

MIT
