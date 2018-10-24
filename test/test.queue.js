const tap = require('tap');
const Hapi = require('hapi');

const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017/queue';

tap.test('adds queue to hapi', async t => {
  const server = new Hapi.Server({ port: 8080 });
  await server.register({
    plugin: require('../index.js'),
    options: {
      verbose: true,
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
  server.queue.queueJob({
    name: 'testJob',
    payload: {
      foo: 1234
    }
  });
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  await wait(1500);
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
  const response = await server.inject({
    url: '/who/stats'
  });
  t.match(response.result, {
    waiting: '0',
    processing: 0,
    cancelled: 0,
    failed: 0,
  });
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
    groupKey: 'key',
    payload: {
      foo: 1234
    }
  });
  await new Promise(resolve => setTimeout(resolve, 3000));
  t.ok(events['queue.process']);
  t.ok(events['queue.finish']);
  t.ok(events['queue.queue']);
  t.equal(events['queue.process'].name, 'testJob');
  t.equal(events['queue.finish'].name, 'testJob');
  t.equal(events['queue.queue'].name, 'testJob');
  await server.stop();
  t.end();
});
