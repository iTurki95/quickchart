const QuickChart = require('quickchart-js');

const chart = new QuickChart();

chart.setWidth(800);
chart.setHeight(400);
chart.setVersion('4'); // مهم جدًا علشان تستخدم plugin funnel

chart.setConfig({
  type: 'funnel',
  data: {
    labels: ['Step 1', 'Step 2', 'Step 3', 'Step 4'],
    datasets: [
      {
        data: [0.7, 0.66, 0.61, 0.15],
        backgroundColor: ['#6ee7b7', '#7dd3fc', '#c4b5fd', '#fca5a5'],
      },
    ],
  },
  options: {
    indexAxis: 'x',
    plugins: {
      legend: { display: false },
      datalabels: {
        color: '#fff',
        font: {
          weight: 'bold',
          size: 16,
        },
        formatter: val => `${(val * 100).toFixed(0)}%`,
      },
    },
  },
  plugins: {
    funnel: true,
    datalabels: true,
  },
});

console.log('Chart URL:', chart.getUrl());

chart.toFile('funnel-chart.png').then(() => {
  console.log('✅ Chart saved as funnel-chart.png');
});
