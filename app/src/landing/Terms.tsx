import { DocPage, Mail, type DocPageProps } from './DocPage';

export function Terms({ links }: DocPageProps) {
  return (
    <DocPage title="Terms" updated="13 October 2026" links={links}>
      <p>These are the rules for using Shawarma REPL. By signing in you agree to them.</p>

      <h2>Your songs are yours</h2>
      <p>You own the code you write, the changes Shawarma suggests that you accept, and the audio you export. You let us store and process them only to run the service for you: saving versions, playing and exporting your songs, and sending requests to Shawarma.</p>
      <p>You are responsible for having the rights to any audio you upload. The sound libraries built into Strudel come with their own licences.</p>

      <h2>Plans</h2>
      <p>The free plan includes the editor, sounds and export, with a limit on how many projects and how much storage you keep. It does not include replies from Shawarma. If you had more projects or files than the free plan keeps, they stay; you just can't add more until you are under the limit.</p>
      <p>Pro includes a monthly allowance of replies from Shawarma, more projects and more storage. When your allowance runs out, the editor, playback and export keep working; Shawarma waits until the allowance resets. On busy days Shawarma may also pause for everyone until the next day.</p>
      <p>Pro starts with a 7-day free trial, once per person. You add a card at checkout; it is charged when the trial ends unless you cancel before then. The trial includes a smaller allowance of replies, which may pause for the day when many trials are running.</p>
      <p>Pro is sold through Polar, renews monthly or yearly, and can be cancelled at any time from Manage billing in the app. Cancelling stops the next renewal; you keep Pro until the end of the period you paid for.</p>

      <h2>Fair use</h2>
      <ul>
        <li>One account per person. Do not share your sign-in.</li>
        <li>Do not use Shawarma to make anything illegal, or try to get around the allowance, break the service or reach other people’s data.</li>
        <li>Do not use automated scripts to send requests to Shawarma.</li>
      </ul>
      <p>We may suspend an account that breaks these rules. Where we can, we will tell you why first and let you download your songs.</p>

      <h2>Shawarma makes mistakes</h2>
      <p>Shawarma’s suggestions come from an AI model. They can be wrong, sound bad or break your song, which is why nothing changes until you accept it, and why every version is kept. The service is provided as it is, without guarantees, and we are not liable for lost work beyond what the law requires.</p>

      <h2>The code behind it</h2>
      <p>Shawarma REPL is free software under the GNU Affero General Public License, version 3 or later. That licence covers the software; these terms cover the hosted service. The <a href={links?.source ?? '/source'}>source code page</a> says how to get a copy.</p>

      <h2>Changes and questions</h2>
      <p>If these terms change in a way that matters, we will tell you in the app before it takes effect. Questions go to <Mail subject="Shawarma terms" />.</p>
    </DocPage>
  );
}
