const Queue = require('@firstandthird/queue');

const defaults = {
  verbose: false,
  routeEndpoint: '/queue',
  jobsDir: process.cwd(),
  maxThreads: 5,
  refreshRate: 10 * 1000 // 10 seconds by default
};

const register = async function(server, pluginOptions) {
  const options = Object.assign({}, defaults, pluginOptions);
  const queue = new Queue(options.mongoUrl, 'queue', options.refreshRate, options.maxThreads);

  queue.createJobs(options.jobsDir);
  queue.bind(server);

  ['queue', 'process', 'finish', 'cancel', 'group.finish'].forEach(e => {
    // log if verbose
    if (options.verbose) {
      queue.on(e, data => {
        server.log(['queue', e], data);
      });
    }
    // pass events up to the server:
    const eventName = `queue.${e}`;
    server.event(eventName);
    queue.on(e, async data => {
      await server.events.emit(eventName, data);
    });
  });

  // 'failed' will always log and reports an additional err object:
  queue.on('failed', (job, err) => {
    server.events.emit('queue.failed', job);
    server.log(['queue', 'error', 'failed'], {
      job,
      err
    });
  });

  server.decorate('server', 'queue', queue);

  if (options.routeEndpoint) {
    server.route({
      path: `${options.routeEndpoint}/stats`,
      method: 'GET',
      handler(request, h) {
        return queue.stats();
      }
    });

    server.route({
      path: `${options.routeEndpoint}/start`,
      method: 'GET',
      async handler(request, h) {
        await queue.start();
        return { status: 'started' };
      }
    });

    server.route({
      path: `${options.routeEndpoint}/stop`,
      method: 'GET',
      async handler(request, h) {
        await queue.stop();
        return { status: 'stopped' };
      }
    });
  }

  server.events.on('start', async() => {
    await queue.start();
  });
  server.events.on('stop', async() => {
    await queue.stop();
  });
};

exports.plugin = {
  once: true,
  name: 'queue',
  register
};
