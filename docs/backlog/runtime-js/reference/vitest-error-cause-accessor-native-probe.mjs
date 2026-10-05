import { deserialize, serialize } from 'node:v8';
let gets = 0;
const error = new Error('outer');
Object.defineProperty(error, 'cause', {
  get() {
    gets++;
    return Buffer.from([1]);
  },
});
const value = deserialize(serialize(error));
console.log(process.version, gets, Object.hasOwn(value, 'cause'), value.cause);
