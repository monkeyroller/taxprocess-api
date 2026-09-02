/** Which of the authority's two worlds a request is for. Each provider maps it to its own naming. */
export type GenericEnvironment = 'production' | 'testing';

export const GENERIC_ENVIRONMENTS = ['production', 'testing'] as const;
