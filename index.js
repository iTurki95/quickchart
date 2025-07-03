const path = require('path');
const express = require('express');
const javascriptStringify = require('javascript-stringify').stringify;
const qs = require('qs');
const rateLimit = require('express-rate-limit');
const text2png = require('text2png');

const packageJson = require('./package.json');
const telemetry = require('./telemetry');
const { getPdfBufferFromPng, getPdfBufferWithText } = require('./lib/pdf');
const { logger } = require('./logging');
const { renderChartJs } = require('./lib/charts');
const { renderGraphviz } = require('./lib/graphviz');
const { toChartJs, parseSize } = require('./lib/google_image_charts');
const { renderQr, DEFAULT_QR_SIZE } = require('./lib/qr');

const app = express();
const isDev = app.get('env') === 'development' || app.get('env') === 'test';

app.set('query parser', (str) =>
  qs.parse(str, {
    decode(s) {
      return decodeURIComponent(s);
    },
  }),
);

app.use(express.json({ limit: process.env.EXPRESS_JSON_LIMIT || '100kb' }));
app.use(express.urlencoded());

if (process.env.RATE_LIMIT_PER_MIN) {
  const limitMax = parseInt(process.env.RATE_LIMIT_PER_MIN, 10);
  logger.info('Enabling rate limit:', limitMax);

  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: limitMax,
    message:
      'Please slow down your requests! This is a shared public endpoint. Email support@quickchart.io or go to https://quickchart.io/pricing/ for rate limit exceptions or to purchase a commercial license.',
    onLimitReached: (req) => {
      logger.info('User hit rate limit!', req.ip);
    },
    keyGenerator: (req) => req.headers['x-forwarded-for'] || req.ip,
  });

  app.use('/chart', limiter);
}

app.get('/', (req, res) => {
  res.send(
    'QuickChart is running!<br><br>If you are using QuickChart commercially, please consider <a href="https://quickchart.io/pricing/">purchasing a license</a> to support the project.',
  );
});

app.post('/telemetry', (req, res) => {
  const chartCount = parseInt(req.body.chartCount, 10);
  const qrCount = parseInt(req.body.qrCount, 10);
  const pid = req.body.pid;

  if (chartCount && !isNaN(chartCount)) telemetry.receive(pid, 'chartCount', chartCount);
  if (qrCount && !isNaN(qrCount)) telemetry.receive(pid, 'qrCount', qrCount);

  res.send({ success: true });
});

function utf8ToAscii(str) {
  const enc = new TextEncoder();
  return Array.from(enc.encode(str))
    .map((v) => String.fromCharCode(v))
    .join('');
}

function sanitizeErrorHeader(msg) {
  return typeof msg === 'string' ? utf8ToAscii(msg).replace(/\r?\n|\r/g, '') : '';
}

function failPng(res, msg, statusCode = 500) {
  res.writeHead(statusCode, {
    'Content-Type': 'image/png',
    'X-quickchart-error': sanitizeErrorHeader(msg),
  });
  res.end(text2png(`Chart Error: ${msg}`, { padding: 10, backgroundColor: '#fff' }));
}

function failSvg(res, msg, statusCode = 500) {
  res.writeHead(statusCode, {
    'Content-Type': 'image/svg+xml',
    'X-quickchart-error': sanitizeErrorHeader(msg),
  });
  res.end(`
<svg viewBox="0 0 240 80" xmlns="http://www.w3.org/2000/svg">
  <style>p { font-size: 8px; }</style>
  <foreignObject width="240" height="80"
   requiredFeatures="http://www.w3.org/TR/SVG11/feature#Extensibility">
    <p xmlns="http://www.w3.org/1999/xhtml">${msg}</p>
  </foreignObject>
</svg>`);
}

async function failPdf(res, msg) {
  const buf = await getPdfBufferWithText(msg);
  res.writeHead(500, {
    'Content-Type': 'application/pdf',
    'X-quickchart-error': sanitizeErrorHeader(msg),
  });
  res.end(buf);
}

function renderChartToPng(req, res, opts) {
  opts.failFn = failPng;
  opts.onRenderHandler = (buf) => {
    res
      .type('image/png')
      .set({ 'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800' })
      .send(buf)
      .end();
  };
  doChartjsRender(req, res, opts);
}

function renderChartToSvg(req, res, opts) {
  opts.failFn = failSvg;
  opts.onRenderHandler = (buf) => {
    res
      .type('image/svg+xml')
      .set({ 'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800' })
      .send(buf)
      .end();
  };
  doChartjsRender(req, res, opts);
}

async function renderChartToPdf(req, res, opts) {
  opts.failFn = failPdf;
  opts.onRenderHandler = async (buf) => {
    const pdfBuf = await getPdfBufferFromPng(buf);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuf.length,
      'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800',
    });
    res.end(pdfBuf);
  };
  doChartjsRender(req, res, opts);
}

function doChartjsRender(req, res, opts) {
  if (!opts.chart) return opts.failFn(res, 'You are missing variable `c` or `chart`');

  const width = parseInt(opts.width, 10) || 500;
  const height = parseInt(opts.height, 10) || 300;
  let untrustedInput = opts.chart;

  if (opts.encoding === 'base64') {
    try {
      untrustedInput = Buffer.from(opts.chart, 'base64').toString('utf8');
    } catch (err) {
      logger.warn('base64 malformed', err);
      return opts.failFn(res, err);
    }
  }

  renderChartJs(
    width,
    height,
    opts.backgroundColor,
    opts.devicePixelRatio,
    opts.version || '2.9.4',
    opts.format,
    untrustedInput,
  )
    .then(opts.onRenderHandler)
    .catch((err) => {
      logger.warn('Chart error', err);
      opts.failFn(res, err);
    });
}

function handleGChart(req, res) {
  if (req.query.cht.startsWith('gv')) {
    const format = req.query.chof;
    const engine = req.query.cht.includes(':') ? req.query.cht.split(':')[1] : 'dot';
    const opts = { format, engine };

    if (req.query.chs) {
      const size = parseSize(req.query.chs);
      opts.width = size.width;
      opts.height = size.height;
    }

    return handleGraphviz(req, res, req.query.chl, opts);
  }

  if (req.query.cht === 'qr') {
    const size = parseInt(req.query.chs.split('x')[0], 10);
    const qrData = req.query.chl;
    const chldVals = (req.query.chld || '').split('|');
    const ecLevel = chldVals[0] || 'L';
    const margin = chldVals[1] || 4;

    return renderQr('png', 'UTF-8', qrData, {
      margin,
      width: size,
      errorCorrectionLevel: ecLevel,
    })
      .then((buf) => {
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': buf.length,
          'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800',
        });
        res.end(buf);
      })
      .catch((err) => failPng(res, err));
  }

  let converted;
  try {
    converted = toChartJs(req.query);
  } catch (err) {
    logger.error(`GChart error: ${req.originalUrl}`);
    return res.status(500).end('Unsupported chart configuration');
  }

  renderChartJs(
    converted.width,
    converted.height,
    converted.backgroundColor,
    1.0,
    '2.9.4',
    undefined,
    converted.chart,
  ).then((buf) => {
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': buf.length,
      'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800',
    });
    res.end(buf);
  });

  telemetry.count('chartCount');
}

app.get('/chart', (req, res) => {
  if (req.query.cht) return handleGChart(req, res);

  const format = (req.query.f || req.query.format || 'png').toLowerCase();
  const opts = {
    chart: req.query.c || req.query.chart,
    height: req.query.h || req.query.height,
    width: req.query.w || req.query.width,
    backgroundColor: req.query.backgroundColor || req.query.bkg,
    devicePixelRatio: req.query.devicePixelRatio,
    version: req.query.v || req.query.version,
    encoding: req.query.encoding || 'url',
    format,
  };

  if (format === 'pdf') return renderChartToPdf(req, res, opts);
  if (format === 'svg') return renderChartToSvg(req, res, opts);
  if (format === 'png') return renderChartToPng(req, res, opts);

  res.status(500).end(`Unsupported format: ${format}`);
});

app.post('/chart', (req, res) => {
  const format = (req.body.f || req.body.format || 'png').toLowerCase();
  const opts = {
    chart: req.body.c || req.body.chart,
    height: req.body.h || req.body.height,
    width: req.body.w || req.body.width,
    backgroundColor: req.body.backgroundColor || req.body.bkg,
    devicePixelRatio: req.body.devicePixelRatio,
    version: req.body.v || req.body.version,
    encoding: req.body.encoding || 'url',
    format,
  };

  if (format === 'pdf') return renderChartToPdf(req, res, opts);
  if (format === 'svg') return renderChartToSvg(req, res, opts);
  renderChartToPng(req, res, opts);
});

app.get('/qr', (req, res) => {
  const qrText = req.query.text;
  if (!qrText) return failPng(res, 'Missing `text`');

  const format = req.query.format === 'svg' ? 'svg' : 'png';
  const margin = typeof req.query.margin === 'undefined' ? 4 : parseInt(req.query.margin, 10);
  const ecLevel = req.query.ecLevel || undefined;
  const size = Math.min(3000, parseInt(req.query.size, 10)) || DEFAULT_QR_SIZE;

  const qrOpts = {
    margin,
    width: size,
    errorCorrectionLevel: ecLevel,
    color: {
      dark: req.query.dark || '000',
      light: req.query.light || 'fff',
    },
  };

  renderQr(format, req.query.mode, qrText, qrOpts)
    .then((buf) => {
      res.writeHead(200, {
        'Content-Type': format === 'png' ? 'image/png' : 'image/svg+xml',
        'Content-Length': buf.length,
        'Cache-Control': isDev ? 'no-cache' : 'public, max-age=604800',
      });
      res.end(buf);
    })
    .catch((err) => failPng(res, err));
});

app.get('/gchart', handleGChart);

app.get('/healthcheck', (req, res) => {
  res.send({ success: true, version: packageJson.version });
});

app.get('/healthcheck/chart', (req, res) => {
  const labels = [...Array(5)].map(() => Math.random());
  const data = [...Array(5)].map(() => Math.random());
  const chart = `
{
  type: 'bar',
  data: {
    labels: [${labels.join(',')}],
    datasets: [{ data: [${data.join(',')}] }]
  }
}`;
  res.redirect(`/chart?c=${chart}`);
});

const port = process.env.PORT || 3400;
const server = app.listen(port);

const timeout = parseInt(process.env.REQUEST_TIMEOUT_MS, 10) || 5000;
server.setTimeout(timeout);
logger.info(`Listening on port ${port} (Timeout: ${timeout} ms)`);

if (!isDev) {
  const shutdown = () => {
    logger.info('Graceful shutdown...');
    server.close(() => {
      logger.info('Closed connections.');
      process.exit();
    });

    setTimeout(() => {
      logger.error('Force shutdown.');
      process.exit();
    }, 10_000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGABRT', () => logger.info('Caught SIGABRT'));
}

module.exports = app;
