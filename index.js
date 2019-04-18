const Queue = require('@firstandthird/queue');
const joi = require('joi');
const fs = require('fs');
const defaults = {
  logInterval: 30 * 1000,
  verbose: false,
  routeEndpoint: '/queue',
  jobsDir: process.cwd(),
  maxThreads: 5,
  refreshRate: 10 * 1000 // 10 seconds by default
};

const register = function(server, pluginOptions) {
  const options = Object.assign({}, defaults, pluginOptions);
  let prom;
  let logIntervalTimer;
  if (server.plugins['hapi-prom']) {
    prom = server.plugins['hapi-prom'].client;
  }
  const queue = new Queue(options.mongoUrl, 'queue', options.refreshRate, options.maxThreads, prom, options.timeout);
  if (typeof options.jobsDir === 'string' && fs.existsSync(options.jobsDir)) {
    queue.createJobs(options.jobsDir);
  }
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
        server.log(['queue', e], {
          message: `${data.name} - ${data.status}`,
          payload: data
        });
      }
      // pass up to the server:
      server.events.emit(eventName, data);
    });
  });

  server.decorate('server', 'queue', queue);

  if (options.routeEndpoint) {
    const extractSince = (paramString) => {
      if (!paramString) {
        paramString = '1d';
      }
      const day = new RegExp('(\\d+)(d)').exec(paramString);
      const hour = new RegExp('(\\d+)(h)').exec(paramString);
      const minute = new RegExp('(\\d+)(m)').exec(paramString);
      const hourValue = hour ? hour[1] : 0;
      const dayValue = day ? day[1] : 0;
      const minuteValue = minute ? minute[1] : 0;
      const today = new Date();
      if (hourValue === 0 && minuteValue === 0) {
        today.setHours(0, 0, 0, 0);
      } else {
        today.setSeconds(0, 0);
      }
      const thresholdTime = today.getTime();
      return thresholdTime - ((minuteValue * 60 * 1000) + (dayValue * 86400000) + (hourValue * 3600000));
    };

    server.route({
      path: `${options.routeEndpoint}/stats`,
      method: 'GET',
      handler(request, h) {
        return queue.stats(extractSince(request.query.since), request.query.groupKey);
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

    server.route({
      path: `${options.routeEndpoint}/pause`,
      method: 'GET',
      async handler(request, h) {
        await queue.pause();
        return { status: 'paused' };
      }
    });


    server.route({
      path: options.routeEndpoint,
      method: 'GET',
      config: {
        validate: {
          query: {
            since: joi.string().default('1d').optional(),
            status: joi.string().optional(),
            groupKey: joi.string().optional()
          }
        }
      },
      handler(request, h) {
        const query = {
          createdOn: {
            $gt: new Date(extractSince(request.query.since))
          }
        };
        if (request.query.status) {
          query.status = request.query.status;
        }
        if (request.query.groupKey) {
          query.groupKey = request.query.groupKey;
        }
        return queue.findJobs(query);
      }
    });
  }

  server.events.on('start', async() => {
    if (options.verbose) {
      logIntervalTimer = setInterval(async() => {
        server.log(['hapi-queue', 'stats'], await queue.stats());
      }, options.logInterval);
    }
    await queue.start();
  });
  server.events.on('stop', async() => {
    clearInterval(logIntervalTimer);
    await queue.stop();
  });
};

exports.plugin = {
  once: true,
  name: 'queue',
  register
};
