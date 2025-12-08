# Logiks Microapp Boilerplate

Each MicroApp is an independent containerised app that contains all the requirements that when plugged into a properly configured MicroAppServer will be fully functional application. They can be hot plugged and removed from AppServer. This allows rapid development and deployment of services without the need to continous restart of the complete service stack.

## Getting Started

### Installation

```bash
git clone git@github.com:Logiks/Logiks-Microapps-Boilerplate-NodeJS.git
cd logiks-microapps-boilerplate-nodejs/
npm install
```

### Starting the Microapp Service

Copy env_sample to .env
Configure the .env file to point the correct transporter/connector/databus with which the MicroAppServer is also connected, along with respective server_token.

```bash
npm start
```