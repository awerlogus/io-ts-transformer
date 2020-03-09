import { Type, StrictType } from 'io-ts'


export function buildDecoder<A>():
  A extends Array<any>
  ? Type<A, A, unknown>
  : A extends object
  ? StrictType<A, A, A, unknown>
  : Type<A, A, unknown>


export type FromIoTs<T extends Type<any>> = T extends Type<infer P> ? P : never
