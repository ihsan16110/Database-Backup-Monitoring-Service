import React from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const data = [
  { name: "Mon", backup: 80 },
  { name: "Tue", backup: 100 },
  { name: "Wed", backup: 75 },
  { name: "Thu", backup: 90 },
  { name: "Fri", backup: 60 },
];

const Chart: React.FC = () => {
  return (
    <div className="col-span-2">
      <h3 className="text-xl font-bold mb-4">Backup Performance</h3>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="backup" stroke="#8884d8" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

export default Chart;
