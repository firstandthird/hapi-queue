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
      jobsDir: `${__dirname}/jobs`
    }
  });
  t.ok(server.queue);
  t.ok(server.queue.jobs);
  t.equal(server.queue.collectionName, 'queue');
  await server.queue.start();
  let called = false;
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
  t.ok(called);
  t.end();
});

/*
tap.test('supports autoStart', async t => {
  const server = new Hapi({ port: 8080 });
  await server.register({
    plugin: require('../index.js'),
    options: {
      verbose: true,
    }
  });
  t.end();
});

tap.test('supports routeEndpoint', async t => {
  const server = new Hapi({ port: 8080 });
  await server.register({
    plugin: require('../index.js'),
    options: {
      verbose: true,
    }
  });
  t.end();
});
*/
