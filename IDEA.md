# The problem

Working with Claude and other AI agents it's incredibly easy to generate dozens of meaningful diffs per day. This is fantastic, but it also means humans are more and more stretched for time when it comes to supervising the output of the AIs, and what's more, code reviewers of large projects still have to review the code that's getting sent to their repos for review. 

Finding out that you have 10 new PRs to review and not knowing where to start can be tiring and slow. On the other hand, having to review your own work from long coding sessions with Claude can also be exhausting, it's like reviewing someone else's solution to a problem you have already thought about, which means you have familiarity with the idea and the domain but may not know much about the code itself. 

Finally, these days I spend most of my time tweaking specs and then reviewing rather than writing code manually. I'm curious about what a tool that begins with review in mind (rather than editing) can look like.

# What's out there

- Copilot-style reviewers for GitHub, which review a PR based on rules and provide feedback to the authors, responding to updates. These are nice but they don't solve the "How do I even start to review this code, as a human?" problem. 
- Agentic review workflows, such as setting up some agents in the background to review code based on skills and coming back to a summary of findings, or even a summary of findings + solutions. These are great, but it's often overwhelming to have to also validate all of those. They are a part of the solution but not the human element of it. 
- Terminal based diff viewers with AI assistants
- IDE review tools


# What's missing

A review tool that accompanies you, the human reviewer, and becomes your guide as you parse through all the code you and your colleagues managed to create and delete throughout the day. 

It should help you 

- remain present and engaged, so that you don't get distracted mid-review
    - have easy ways to get back and forth from code sections
    - allow AI to guide you on what to review next - short functions should come up for review automatically , or near automatically, when you review something that uses them, with an automated review already ready and explainers built-in
   
- validate that you understand, so that review sessions don't become a LGTM! party

- highlight what you already reviewed without needing to be told about it - we can start by
     - assuming that any highlighted line was reviewed already
     - have a reviewed marker next to code, not just at the file level , so that you don't get lost

- have micro-skills, or contextual skill loaders, so that in a large PR we could pull up "review Gutenberg block" automatically alongside "review new WordPress plugin configuration" - in most infra this will happen automatically when you push, but a human may still request specific skill reviews as they go along

- code sections should have coverage-like markers to know if AI and humans have both evaluated it

- request a teammate's review for a block of code specifically vs. the whole diff - this is already easy to work around with current tools, it's just ideal if we can have this as a primitive so that we can apply it to AI agents too - some agents can be assigned specific blocks automatically 

- review code easily locally, regardless of your remote, and with an option to store local reviews that both you and your agents can keep working on top of - this is particularly useful if we can feed it back with the right context to agents 

- confidently review greenfield work before pushing a first version of a prototype - it should help you figure out what you've seen in a whole project, from "zero" to current

- easily integrate insight from agent interactions during review, to better understand the path taken by the agent when needed

# UX considerations

- This should be a web tool so that it's very easy to collaborate with teammates on reviews in the future, but I'd love to have a dual mode tool. One web mode and one TUI mode. 
- We should make this work with any 2 git diffs , not required to be GitHub
- The reviews can persist for now just in a browser storage for prototype purposes, but it will be changed to a persistent storage later on 
- There needs to be a connector API so that reviews _can_ be sent over to the right infra (GitHub, GitLab, etc) through APIs - not just as a local reviewer
- The diffs for now are pasted or uploaded as files, however, we will later allow just pointing to a URL with a diff too, like .diff in github, or to a PR