const Queue = require('@firstandthird/queue');
const joi = require('joi');

const defaults = {
  verbose: false,
  routeEndpoint: '/queue',
  findEndpoint: '/find',
  jobsDir: process.cwd(),
  maxThreads: 5,
  refreshRate: 10 * 1000 // 10 seconds by default
};

const register = async function(server, pluginOptions) {
  const options = Object.assign({}, defaults, pluginOptions);
  let prom;
  if (server.plugins['hapi-prom']) {
    prom = server.plugins['hapi-prom'].client;
  }
  const queue = new Queue(options.mongoUrl, 'queue', options.refreshRate, options.maxThreads, prom);

  queue.createJobs(options.jobsDir);
  queue.bind(server);

  ['queue', 'process', 'finish', 'cancel', 'group.finish', 'failed'].forEach(e => {
    // be able to pass events up to the server:
    const eventName = `queue.${e}`;
    server.event(eventName);

    queue.on(e, (data, err) => {
      // always log failures:
      if (e === 'failed') {
        server.log(['queue', 'error', 'failed'], {
          data,
          err
        });
      } else if (options.verbose) {
        data.msg = `${data.name} - ${data.status}`;
        server.log(['queue', e], data);
      }
      // pass up to the server:
      server.events.emit(eventName, data);
    });
  });

  server.decorate('server', 'queue', queue);

  server.route({
    path: options.findEndpoint,
    method: 'GET',
    config: {
      validate: {
        query: {
          status: joi.string().optional()
        }
      }
    },
    handler(request, h) {
      const twentyFour = new Date(new Date().getTime() - (24 * 60 * 60 * 1000));
      const query = {
        endTime: {
          $gt: twentyFour
        }
      };
      if (request.query.status) {
        query.status = request.query.status;
      }
      return queue.findJobs(query);
    }
  });

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
