import { Type, StrictType } from 'io-ts'

export function buildDecoder<A>():
  A extends Array<any>
  ? Type<A, A, unknown>
  : A extends object
  ? StrictType<A, A, A, unknown>
  : Type<A, A, unknown>
