// Repassa a requisição sem alterá-la (URL, cabeçalhos e corpo) ao Worker do app. Como o Host e o Origin continuam
// sendo os do pages.dev, cookies, redirecionamentos e a proteção de origem das server actions funcionam normalmente.
const forwarder = {
  fetch(request, env) {
    return env.APP.fetch(request);
  },
};

export default forwarder;
