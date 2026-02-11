export function canMutateWithToken(request: Request): boolean {
  const requiredToken = process.env.UPLOAD_API_TOKEN;
  if (!requiredToken) {
    return process.env.NODE_ENV !== "production";
  }

  const tokenFromHeader = request.headers.get("x-upload-token");
  return tokenFromHeader === requiredToken;
}
