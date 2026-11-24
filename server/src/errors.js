// One error envelope for every failure: {"error": {"code", "message", "details"}}.

export const ERROR_STATUS = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation: 422,
  rate_limited: 429,
  busy: 409,
  not_in_hand: 409,
  match_not_live: 409,
  cooldown: 429,
  code_too_large: 413,
  empty_code: 422,
  no_charges: 409,
  conflict: 409,
  server_error: 500,
};

export class AppError extends Error {
  constructor(code, message = '', details = null, status = null) {
    super(message || code);
    this.code = code;
    this.message = message || code.replace(/_/g, ' ');
    this.details = details || {};
    this.status = status || ERROR_STATUS[code] || 400;
  }
}

/** A command the match actor rejected: no state change, nothing broadcast. */
export class RuleError extends AppError {}

export function envelope(code, message, details = null) {
  return { error: { code, message, details: details || {} } };
}

/** Express error handler: AppErrors keep their code; anything else is a 500. */
export function errorMiddleware(log) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    if (err instanceof AppError) {
      if (err.details && err.details.retry_after !== undefined) {
        res.set('Retry-After', String(Math.max(1, Math.ceil(err.details.retry_after))));
      }
      res.status(err.status).json(envelope(err.code, err.message, err.details));
      return;
    }
    if (err && (err.type === 'entity.too.large' || err.status === 413)) {
      res.status(413).json(envelope('validation', 'Request body too large'));
      return;
    }
    if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
      res.status(422).json(envelope('validation', 'Invalid request', { errors: [{ loc: ['body'], msg: 'invalid JSON' }] }));
      return;
    }
    log.error('unhandled error', { error: String(err && err.stack ? err.stack : err) });
    res.status(500).json(envelope('server_error', 'Something went wrong'));
  };
}
