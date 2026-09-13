/**
 * Copyright (c) 2026 tbaur
 *
 * Licensed under the Apache License, Version 2.0
 * See LICENSE file for full license text
 *
 * @fileoverview API module exports.
 */
export { TokenManager, buildAuthorizeUrl, exchangeAuthorizationCode, extractAuthorizationCode, generateOAuthState, } from './auth';
export type { AuthLogger, AuthorizationCodeExchangeOptions, RequestToken, TokenManagerOptions, } from './auth';
export { ResideoApiClient } from './client';
export type { ApiClientOptions, ClientLogger, ClientStatus, RawResponse, RequestMetric } from './client';
export { TOKEN_FILE_MODE, TOKEN_STORE_FILE_PREFIX, TOKEN_STORE_VERSION, TokenStore, resolveTokenStorePath, sanitizeInstanceName, tokenStoreFileName, } from './token-store';
export type { StoredTokens, TokenStoreOptions, TokenStoreRecord } from './token-store';
export { CircuitBreaker, CircuitState, DEFAULT_CIRCUIT_BREAKER_CONFIG } from './circuit-breaker';
export type { CircuitBreakerConfig, CircuitBreakerStatus } from './circuit-breaker';
//# sourceMappingURL=index.d.ts.map