const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
require('chart.js'); // Chart.js v2.9.4
require('chartjs-plugin-funnel'); // Funnel plugin

const fs = require('fs');

const width = 800;
const height = 600;
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

(async () => {
  const configuration = {
    type: 'funnel',
    data: {
      labels: ['Visited', 'Viewed Product', 'Added to Cart', 'Checkout', 'Purchased'],
      datasets: [{
        data: [1000, 800, 500, 300, 150],
        backgroundColor: ['#36A2EB', '#4BC0C0', '#FFCE56', '#FF9F40', '#FF6384']
      }]
    },
    options: {
      responsive: false,
      maintainAspectRatio: false,
      legend: { display: false }
    }
  };

  const image = await chartJSNodeCanvas.renderToBuffer(configuration);
  fs.writeFileSync('./funnel-chart.png', image);
  console.log('✅ Funnel chart saved as funnel-chart.png');
})();
