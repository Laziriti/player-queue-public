export function isRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export const isString = value => typeof value === 'string';
export const isBoolean = value => typeof value === 'boolean';
export const isNumber = Number.isFinite;

export const arrayOf = check => value => Array.isArray(value) && value.every(check);
export const recordOf = check => value => isRecord(value) && Object.values(value).every(check);
export const optionalFields = (value, fields) => Object.entries(fields)
    .every(([key, check]) => value[key] == null || check(value[key]));
