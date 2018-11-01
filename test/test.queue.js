const tap = require('tap');
const Hapi = require('hapi');

const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/queue';

tap.test('adds queue to hapi', async t => {
  const server = new Hapi.Server({ port: 8080 });
  await server.register({
    plugin: require('../index.js'),
    options: {
      verbose: true,
      logInterval: 1000,
      mongoUrl,
      refreshRate: 500,
      jobsDir: `${__dirname}/jobs`
    }
  });
  t.ok(server.queue);
  t.ok(server.queue.jobs);
  t.equal(server.queue.collectionName, 'queue');
  let called = false;
  await server.start();
  server.queue.createJob({
    name: 'testJob',
    process(data, queue, j) {
      called = true;
    }
  });
  server.events.on('log', input => {
    if (input.tags.includes('stats')) {
      t.ok(input.data.completed);
      t.ok(input.data.failed);
    }
  });
  server.queue.queueJob({
    name: 'testJob',
    payload: {
      foo: 1234
    }
  });
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  await wait(3000);
  await server.stop();
  t.ok(called);
  t.end();
});

tap.test('supports routeEndpoint', async t => {
  const server = new Hapi.Server({ port: 8080 });
  await server.register({
    plugin: require('../index.js'),
    options: {
      routeEndpoint: '/who',
      verbose: false,
      mongoUrl,
      jobsDir: `${__dirname}/jobs`
    }
  });
  await server.start();
  server.queue.createJob({
    name: 'testJob',
    process(data, queue, j) {}
  });
  server.queue.queueJob({
    name: 'testJob',
    payload: {
      foo: 1234
    }
  });
  const response = await server.inject({
    url: '/who/stats'
  });
  t.match(response.result.waiting, 1);
  t.isA(response.result.completed, 'number');
  await server.stop();
  t.end();
});

tap.test('passes queue events to server', async t => {
  const server = new Hapi.Server({ port: 8080 });
  await server.register({
    plugin: require('../index.js'),
    options: {
      routeEndpoint: '/who',
      verbose: true,
      mongoUrl,
      jobsDir: `${__dirname}/jobs`,
      refreshRate: 500
    }
  });
  await server.start();
  const events = {};
  ['queue', 'process', 'finish', 'cancel', 'group.finish'].forEach(e => {
    const eventName = `queue.${e}`;
    server.events.on(eventName, data => {
      events[eventName] = data;
    });
  });
  server.queue.createJob({
    name: 'testJob',
    process(data, queue, j) {
    }
  });
  server.queue.queueJob({
    name: 'testJob',
    groupKey: 'testJobGroup',
    payload: {
      foo: 1234
    }
  });
  await new Promise(resolve => setTimeout(resolve, 3000));
  t.ok(events['queue.process']);
  t.ok(events['queue.finish']);
  t.ok(events['queue.group.finish']);
  t.ok(events['queue.queue']);
  t.equal(events['queue.process'].name, 'testJob');
  t.equal(events['queue.finish'].name, 'testJob');
  t.equal(events['queue.group.finish'], 'testJobGroup');
  t.equal(events['queue.queue'].name, 'testJob');
  await server.stop();
  t.end();
});

tap.test('supports hapi-prom', async t => {
  const server = new Hapi.Server({ port: 8080 });
  await server.register({
    plugin: require('hapi-prom'),
    options: {
      mongoUrl,
    }
  });
  await server.register({
    plugin: require('../index.js'),
    options: {
      routeEndpoint: '/who',
      verbose: true,
      mongoUrl,
      jobsDir: `${__dirname}/jobs`
    }
  });
  await server.start();
  server.queue.createJob({
    name: 'testJob',
    process(data, queue, j) {}
  });
  server.queue.queueJob({
    name: 'testJob',
    payload: {
      foo: 1234
    }
  });
  const response = await server.inject({
    url: '/metrics'
  });
  t.equal(response.statusCode, 200);
  t.includes(response.result, 'waiting{jobName="testJob"} 1');
  await new Promise(resolve => setTimeout(resolve, 1000));
  await server.stop();
  t.end();
});

tap.test('routeEndpoint suppors find function', async t => {
  const server = new Hapi.Server({ port: 8080 });
  await server.register({
    plugin: require('../index.js'),
    options: {
      verbose: true,
      mongoUrl,
      jobsDir: `${__dirname}/jobs`
    }
  });
  await server.start();
  server.queue.createJob({
    name: 'failJob',
    process(data, queue, j) {
      throw new Error('error');
    }
  });
  server.queue.queueJob({
    name: 'failJob',
    payload: {
      foo: 1234
    }
  });
  server.queue.createJob({
    name: 'okJob',
    process(data, queue, j) {
    }
  });
  server.queue.queueJob({
    name: 'okJob',
    payload: {
      foo: 1234
    }
  });
  await new Promise(resolve => setTimeout(resolve, 1000));
  const response = await server.inject({
    url: '/queue'
  });
  const response2 = await server.inject({
    url: '/queue?status=failed'
  });
  t.ok(response.result.length, '/queue returns jobs');
  response.result.forEach(r => {
    const val = r.createdOn.getTime();
    const now = new Date().getTime();
    t.ok(now - val < (24 * 60 * 60 * 1000), '/queue gets jobs within 24 hours');
  });
  response2.result.forEach(r => t.equal(r.status, 'failed', '/queue?status will filter jobs'));
  await new Promise(resolve => setTimeout(resolve, 1000));
  await server.stop();
  t.end();
});
