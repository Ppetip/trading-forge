export function cleanEmail(value) {
  const email = String(value ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw badRequest("A valid email is required.");
  return email;
}

export function cleanName(value) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw badRequest("Display name must contain 2 to 80 characters.");
  return name;
}

export function requireObject(value, label = "Request body") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest(`${label} must be an object.`);
  return value;
}

export function badRequest(message, code = "BAD_REQUEST") {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  return error;
}
