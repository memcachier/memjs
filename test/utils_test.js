utils = require('../lib/memjs/utils')

console.log('merge should preserve value passed in first parameter');


result = utils.merge({}, { retries: 2 });

if (result.retries == 2) {
  console.log('Looks good.');
} else {
  console.log('It doesn\'t work. Expected { retries: 2 } , Got:', result);
}

result = utils.merge({ retries: 0 }, { retries: 2 });

if (result.retries == 0) {
  console.log('Looks good.');
} else {
  console.log('It doesn\'t work. Expected { retries: 0 } , Got:', result);
}


