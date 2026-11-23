/**
 * Jest stand-in for `weaviate-client`. The real package pulls in ESM-only
 * dependencies (uuid) that Jest's CommonJS loader cannot parse. Specs that
 * exercise NcertSearchService replace `connect()` with a fake client.
 */
export class ApiKey {
  constructor(public readonly apiKey: string) {}
}

export const Filters = {
  and: (...filters: unknown[]) => ({ operator: 'And', filters }),
  or: (...filters: unknown[]) => ({ operator: 'Or', filters }),
};

export type WeaviateClient = any;

const weaviate = {
  connectToWeaviateCloud: jest.fn(() => {
    throw new Error('weaviate-client is stubbed in unit tests');
  }),
};

export default weaviate;
