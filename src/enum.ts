import type { EnumClassValue, EnumImpl } from "./enum_class.ts";

declare const definitionTag: unique symbol;
declare const mutableTag: unique symbol;

export type NoUndefined<T> = Exclude<T, undefined | void>;

export type EnumDefinition = Record<string, any> & { _?: never };

export type DefinitionFromEnum<E extends Enum<EnumDefinition>> = E extends
  Enum<infer D> ? D : never;

export type EnumVariants<D extends EnumDefinition> = Exclude<keyof D, "_">;

export type EnumVariantData<
  D extends EnumDefinition,
  V extends EnumVariants<D>,
> = NoUndefined<D[V]>;

export type EnumFactoryDefaults<E extends Enum<EnumDefinition>> = {
  [V in EnumVariants<DefinitionFromEnum<E>>]: undefined;
};

export type EnumFactory<E extends Enum<EnumDefinition>> = {
  [V in EnumVariants<DefinitionFromEnum<E>>]: (
    data: EnumVariantData<DefinitionFromEnum<E>, V>,
  ) => E;
};

export type ExhaustiveMatcher<D extends EnumDefinition, T> = {
  [V in EnumVariants<D>]: (data: EnumVariantData<D, V>) => T;
};

export type WildcardMatcher<D extends EnumDefinition, T> =
  & Partial<ExhaustiveMatcher<D, T>>
  & { _: () => T };

export type Matcher<D extends EnumDefinition, T> =
  | ExhaustiveMatcher<D, T>
  | WildcardMatcher<D, T>;

/**
 * Marks an enum type as mutable, so it can be mutated by `Enum.mutate`.
 */
export type Mut<E extends Enum<EnumDefinition>> = E & { [mutableTag]?: true };

/**
 * Create an enum type by defining all your variants in the generic `D`. The
 * data type contained in the variants cannot be `undefined`. The variant name
 * cannot be `_`, as it is reserved.
 *
 * ```ts
 * type Message = Enum<{
 *   Quit: null,
 *   Plaintext: string,
 *   Encrypted: number[]
 * }>;
 *
 * let msg: Message = { Encrypted: [4, 8, 15, 16, 23, 42] };
 * ```
 *
 * @template D Definitions of all variants of the enum
 */
export type Enum<D extends EnumDefinition> =
  & {
    [V in EnumVariants<D>]:
      & { readonly [_ in Exclude<EnumVariants<D>, V>]?: never }
      & { readonly [_ in V]-?: EnumVariantData<D, V> };
  }[EnumVariants<D>]
  & {
    readonly [definitionTag]?: D;
    readonly [mutableTag]?: unknown;
  };

function createEnumFactory<E extends Enum<EnumDefinition>>(
  variants: EnumFactoryDefaults<E>,
): EnumFactory<Enum<DefinitionFromEnum<E>>>;
function createEnumFactory<
  I extends Enum<EnumDefinition> & EnumImpl<EnumDefinition>,
>(
  variants: EnumFactoryDefaults<I>,
  Impl: new (value: EnumClassValue<I>) => EnumImpl<EnumDefinition>,
): EnumFactory<I>;
function createEnumFactory<E extends Enum<EnumDefinition>>(
  variants: EnumFactoryDefaults<E>,
  Impl?: new (value: unknown) => unknown,
) {
  let result = {} as Record<
    EnumVariants<DefinitionFromEnum<E>>,
    any
  >;

  for (let key in variants) {
    let variant = key as EnumVariants<DefinitionFromEnum<E>>;

    result[variant] = Impl == null
      ? (data: unknown = null) => ({ [variant]: data })
      : (data: unknown = null) => new Impl({ [variant]: data });
  }

  return result;
}

function createEnumProxyFactory<
  E extends Enum<EnumDefinition>,
>(): EnumFactory<
  Enum<DefinitionFromEnum<E>>
>;
function createEnumProxyFactory<
  I extends Enum<EnumDefinition> & EnumImpl<EnumDefinition>,
>(
  Impl: new (value: EnumClassValue<I>) => EnumImpl<EnumDefinition>,
): EnumFactory<I>;
function createEnumProxyFactory(
  Impl?: new (value: unknown) => unknown,
) {
  return new Proxy({}, {
    get(target, prop) {
      return (data: unknown) =>
        Impl == null ? ({ [prop]: data }) : new Impl({ [prop]: data });
    },
  });
}

export const Enum = {
  factory: createEnumFactory,

  proxyFactory: createEnumProxyFactory,

  /**
   * Inspects the given enum `value` and executes code based on which variant
   * matches `value`.
   *
   * ```ts
   * type Message = Enum<{
   *   Quit: null,
   *   Plaintext: string,
   *   Encrypted: number[]
   * }>;
   *
   * let msg: Message = getMessage();
   *
   * let length = Enum.match(msg, {
   *   Quit: () => -1,
   *   Plaintext: (data) => data.length,
   *   Encrypted: (data) => decrypt(data).length
   * });
   * ```
   *
   * Note that matches need to be exhaustive. You need to exhaust every last
   * possibility in order for the code to be valid. The following code won't
   * compile:
   *
   * ```ts
   * Enum.match(msg, {
   *   Quit: () => console.log("Message stream ended.")
   * });
   * ```
   *
   * In case you don't care about other variants, you can either use the special
   * wildcard match `_` which matches all variants not specified in the matcher,
   * or a simple `if` statement:
   *
   * ```ts
   * Enum.match(msg, {
   *   Quit: () => console.log("Message stream ended."),
   *   _: () => console.log("Stream goes on...")
   * });
   *
   * if (msg.Plaintext !== undefined) {
   *   console.log(msg.Plaintext);
   * }
   * ```
   *
   * @param value The enum value to match against
   * @param matcher
   */
  match: <D extends EnumDefinition, T>(
    value: Enum<D>,
    matcher: Matcher<D, T>,
  ): T => {
    let variant: EnumVariants<D> | "_" = "_";

    for (let key in value) {
      if (value[key] !== undefined && matcher[key] !== undefined) {
        variant = key as EnumVariants<D>;
        break;
      }
    }

    if (variant !== "_") {
      return matcher[variant]!(value[variant]!);
    } else if ("_" in matcher && matcher._ !== undefined) {
      return (matcher as WildcardMatcher<D, T>)._();
    }

    throw new Error(
      "Non-exhaustive matcher. To ensure all possible cases are covered, you " +
        "can add a wildcard `_` match arm.",
    );
  },

  /**
   * Mutates the given `value` enum in-place to match the data in `other`.
   * Requirement: The enum type has to be marked as mutable with `Mut`.
   *
   * ```ts
   * type E = Enum<{
   *   A: number,
   *   B: string
   * }>;
   *
   * const a: E = { A: 5 };
   * Enum.mutate(a, { B: "Hello" }); // Compilation error
   *
   * const b: Mut<E> = { A: 5 };
   * Enum.mutate(b, { B: "Hello" });
   *
   * console.log(b);
   * // => { B: "Hello" }
   * ```
   *
   * @param value
   * @param other
   */
  mutate: <D extends EnumDefinition>(
    value: Mut<Enum<D>>,
    other: Enum<D>,
  ): void => {
    for (let key in value) {
      delete (value as any)[key];
    }

    Object.assign(value, other);
  },
};
