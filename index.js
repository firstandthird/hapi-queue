const Queue = require('@firstandthird/queue');

const defaults = {
  verbose: false,
  routeEndpoint: '/queue',
  jobsDir: process.cwd(),
  refreshRate: 10 * 1000 // 10 seconds by default
};

const register = async function(server, pluginOptions) {
  const options = Object.assign({}, defaults, pluginOptions);
  const queue = new Queue(options.mongoUrl, 'queue', options.refreshRate, 8);

  queue.createJobs(options.jobsDir);
  queue.bind(server);

  if (options.verbose) {
    queue.on('queue', (job) => {
      server.log(['queue', 'queued'], job);
    });

    queue.on('process', (job) => {
      server.log(['queue', 'process'], job);
    });

    queue.on('finish', (job) => {
      server.log(['queue', 'finish'], job);
    });

    queue.on('cancel', (jobId) => {
      server.log(['queue', 'cancel'], jobId);
    });
  }

  queue.on('failed', (job, err) => {
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
