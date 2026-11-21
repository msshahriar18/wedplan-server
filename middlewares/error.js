export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// lets us throw inside async route handlers without try/catch everywhere
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const notFound = (req, res) => {
  res.status(404).send({ message: `Route ${req.method} ${req.originalUrl} not found` });
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).send({
    message: status === 500 ? "Something went wrong on the server" : err.message,
  });
};
