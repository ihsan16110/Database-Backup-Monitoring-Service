import React from "react";
import Card from "../components/Card/Card";

const Settings: React.FC = () => {
  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      {/* <Card title="Application Settings"> */}
        <p>Configure your application settings here.</p>
      {/* </Card> */}
    </div>
  );
};

export default Settings;
