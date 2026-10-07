/* TPoker T2 逻辑单元测试 · Node 运行器：node tests/run-tests.js */
'use strict';

var path = require('path');
var L = require(path.join(__dirname, '..', 'js', 'logic.js'));
var TPStore = require(path.join(__dirname, '..', 'js', 'store.js'));
var TPRanges = require(path.join(__dirname, '..', 'js', 'ranges.js'));
var TPTests = require(path.join(__dirname, 'tests.js'));

var result = TPTests.run(L, TPStore, TPRanges);

for (var i = 0; i < result.lines.length; i++) {
  console.log(result.lines[i]);
}
console.log('');
console.log('T2 结果：' + result.passed + '/' + result.total + ' 通过，' + result.failed + ' 失败');

process.exit(result.failed === 0 ? 0 : 1);
