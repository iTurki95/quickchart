const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const fs = require('fs');

// Chart.js v4
const Chart = require('chart.js');
const {
  FunnelController,
  TrapezoidElement,
} = require('chartjs-chart-funnel');

// سجّل المكونات المطلوبة
Chart.register(
  FunnelController,
  TrapezoidElement,
  Chart.CategoryScale,
  Chart.LinearScale,
  Chart.Legend,
  Chart.Title,
  Chart.Tooltip
);

const width = 800;
const height = 600;
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height, ChartModule: Chart });

(async () => {
  const config = {
    type: 'funnel',
    data: {
      labels: ['Visited', 'Product Page', 'Add to Cart', 'Checkout', 'Purchased'],
      datasets: [
        {
          data: [1000, 800, 500, 300, 100],
          backgroundColor: ['#36A2EB', '#4BC0C0', '#FFCE56', '#FF9F40', '#FF6384'],
        },
      ],
    },
    options: {
      responsive: false,
    },
  };

  const image = await chartJSNodeCanvas.renderToBuffer(config);
  fs.writeFileSync('./funnel-chart.png', image);
  console.log('✅ Funnel chart saved!');
})();
