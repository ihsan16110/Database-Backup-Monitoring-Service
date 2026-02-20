import React from 'react';
import {
  LineChart as ReLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface LineChartProps {
  data?: { name: string; value: number }[]; // Simple data type
  title?: string;
  lineColor?: string;
}

const LineChart: React.FC<LineChartProps> = ({
  data = [
    { name: 'Jan', value: 30 },
    { name: 'Feb', value: 45 },
    { name: 'Mar', value: 60 },
    { name: 'Apr', value: 50 },
    { name: 'May', value: 75 },
    { name: 'Jun', value: 90 },
  ],
  title = 'Monthly Backups',
  lineColor = '#1d4ed8', // Tailwind blue-700
}) => {
  return (
    <div className="bg-white shadow rounded p-4 w-full">
      {title && <h2 className="text-lg font-semibold mb-4">{title}</h2>}
      <ResponsiveContainer width="100%" height={250}>
        <ReLineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="value"
            stroke={lineColor}
            strokeWidth={3}
            activeDot={{ r: 6 }}
          />
        </ReLineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default LineChart;
