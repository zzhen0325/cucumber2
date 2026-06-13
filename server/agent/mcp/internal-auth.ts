const internalMcpBearerToken = crypto.randomUUID();

export function getInternalMcpAuthorizationHeader() {
  return `Bearer ${internalMcpBearerToken}`;
}

export function isAuthorizedInternalMcpRequest(request: Request) {
  return request.headers.get("authorization") === getInternalMcpAuthorizationHeader();
}
